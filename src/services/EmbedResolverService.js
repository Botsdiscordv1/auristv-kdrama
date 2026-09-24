'use strict';

const axios = require('axios');
const { resolveStream } = require('../../stream-resolvers');
const { ERROR_CODES } = require('../../stream-resolvers/core/resolver.types');

// VPS de 1GB RAM: resolver embeds en serie multiplicaba el peor caso (N×25s) y
// lanzarlos todos en paralelo dispararía el pico de memoria. Con un pool pequeño
// (mapLimit) se acota coste y RAM manteniendo el tiempo de respuesta acotado.
const TRACK_TIMEOUT_MS = 15000;
const TRACK_CONCURRENCY = 4;

function waitTimeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseM3u8Variants(m3u8Url, referer) {
  try {
    const { data } = await axios.get(m3u8Url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ...(referer ? { Referer: referer } : {}),
      },
      timeout: 8000,
    });
    const text = typeof data === "string" ? data : String(data);
    if (!text.includes("#EXT-X-STREAM-INF")) return [];

    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
      const info = lines[i];
      const streamUrl = lines[i + 1];
      if (!streamUrl || streamUrl.startsWith("#")) continue;

      const bandwidth = parseInt(info.match(/BANDWIDTH=(\d+)/)?.[1] || "0", 10);
      const resolution = info.match(/RESOLUTION=([^\s,]+)/)?.[1] || null;

      let absUrl = streamUrl;
      if (!streamUrl.startsWith("http")) {
        const base = m3u8Url.replace(/\/[^/]*$/, "/");
        absUrl = streamUrl.startsWith("/") ? new URL(streamUrl, m3u8Url.split("/").slice(0, 3).join("/") + "/").href : base + streamUrl;
      }

      variants.push({
        url: absUrl,
        bandwidth,
        resolution,
        qualityLabel: resolution ? `${resolution.split("x")[1]}p` : `${Math.round(bandwidth / 1000)}k`,
      });
    }
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return variants;
  } catch {
    return [];
  }
}

function mapLimit(items, limit, fn) {
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let next = 0;
    let pending = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const worker = async () => {
      while (next < items.length && !settled) {
        const i = next++;
        pending++;
        try {
          results[i] = await fn(items[i], i);
        } catch (err) {
          return fail(err);
        } finally {
          pending--;
          if (pending === 0 && next >= items.length && !settled) {
            settled = true;
            resolve(results);
          }
        }
      }
    };
    if (items.length === 0) return resolve(results);
    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    Promise.all(workers).catch(fail);
  });
}

class EmbedResolverService {
  async enhance(result, options = {}) {
    if (!result || typeof result !== 'object') return result;

    const timeoutMs = options.timeoutMs || TRACK_TIMEOUT_MS;
    const concurrency = options.concurrency || TRACK_CONCURRENCY;

    if (Array.isArray(result.tracks) && result.tracks.length > 0) {
      await mapLimit(result.tracks, concurrency, (track) => this.resolveTrack(track, timeoutMs));

      // Expand metadata tracks from multi-track resolvers (e.g. embed69 returns
      // vidhide + streamwish + voe but _resolveUrl only picks the first).
      // Only include tracks that were actually resolved (URL points to stream, not embed page).
      const expandedTracks = [];
      for (const track of result.tracks) {
        if (track._metadata?.tracks && track._metadata.tracks.length > 1) {
          const qualities = track.qualities || []; // Preserve qualities from first resolved track
          for (const mt of track._metadata.tracks) {
            if (mt.label?.includes('Descarga')) continue;
            if (mt.provider === 'rapidvideo') continue;
            // Only include if URL was resolved to actual stream (not raw embed page)
            const url = mt.url || '';
            const isResolvedStream = url.includes('.m3u8') || url.includes('.mp4');
            if (!isResolvedStream) continue; // Skip unresolved embeds (voe ALTCHA, streamwish blocked)
            expandedTracks.push({
              label: mt.provider?.charAt(0).toUpperCase() + (mt.provider?.slice(1) || ''),
              quality: track.quality,
              url: url,
              isEmbed: false,
              isDownload: false,
              provider: mt.provider,
              headers: mt.headers || track.headers,
              qualities: mt.provider === track.provider ? qualities : [], // Only first provider gets qualities
            });
          }
          // If no expanded tracks resolved, keep the original
          if (expandedTracks.filter(t => !t.label.includes('Descarga')).length === 0) {
            expandedTracks.push(track);
          }
        } else {
          expandedTracks.push(track);
        }
      }
      result.tracks = expandedTracks;

      // Deduplicate tracks by resolved URL AND provider (different /vidurl/ paths
      // may resolve to same embed with different timestamps)
      const seenUrls = new Set();
      const seenProviders = new Set();
      result.tracks = result.tracks.filter((t) => {
        if (t.available === false) return true; // keep unavailable for fallback
        if (!t.url) return false;
        // Deduplicate by exact URL
        if (seenUrls.has(t.url)) return false;
        // Deduplicate by provider (same server, different timestamps).
        // Los webview-only (varios Servidores del mismo player) solo deduplican
        // por URL exacta para no perder opciones.
        const providerKey = t.provider || t.url;
        if (!t.webviewOnly && seenProviders.has(providerKey)) return false;
        seenUrls.add(t.url);
        seenProviders.add(providerKey);
        return true;
      });
      // Deprioritize tracks whose resolver failed (e.g. a Vidara file that is
      // "not ready"): move unavailable tracks to the end so the player auto-
      // selects a working source instead of a dead one.
      result.tracks = this._prioritizeTracks(result.tracks);
      // The extractor sets result.url/qualities from the original first track
      // (often vidara). Point the default source at the now-first available
      // track so playback starts on a working server, not a dead one.
      const first = result.tracks.find((t) => t.available !== false) || result.tracks[0];
      if (first) {
        result.url = first.url;
        result.headers = first.headers;
        result.qualities = first.qualities;
      }
      return result;
    }

    if (result.url && typeof result.url === 'string') {
      const resolved = await this._resolveUrl(result.url, timeoutMs);
      if (resolved && resolved.metadata && resolved.metadata.webviewOnly && typeof resolved.url === 'string') {
        result.url = resolved.url;
        result.provider = resolved.provider || null;
        result.webviewOnly = true;
        return result;
      }
      if (resolved && typeof resolved.url === 'string') {
        result.url = resolved.url;
        result.headers = { ...(result.headers || {}), ...resolved.headers };
        let providerName = 'Server';
        if (resolved.provider) {
          providerName = resolved.provider.charAt(0).toUpperCase() + resolved.provider.slice(1);
        } else {
          try { providerName = new URL(result.url).hostname.split('.')[0].toUpperCase(); } catch {}
        }
        result.provider = resolved.provider || null;
        // Garantizar una lista de servidores no vacía: el label es el NOMBRE
        // DEL PLAYER resuelto (p.ej. Streamtape, Voe, Barmonrey), no el idioma.
        result.tracks = [{
          label: providerName,
          quality: result.quality || 'SUB',
          url: result.url,
          isEmbed: false,
          isDownload: false,
          provider: resolved.provider || null,
          headers: result.headers,
        }];
        this._log('source', 'resolved', resolved.provider, result.url);
      }
    }
    return result;
  }

  async resolveTrack(track, timeoutMs = TRACK_TIMEOUT_MS) {
    if (!track || typeof track.url !== 'string') return track;

    const outcome = await this._resolveUrl(track.url, timeoutMs);
    if (outcome.unchanged) return track;
    if (outcome.unavailable) {
      // Resolver matched but failed (dead source): keep the track as a last
      // resort but flag it so _prioritizeTracks moves it to the end.
      track.available = false;
      return track;
    }

    // Webview-only (p.ej. player propio de GnulaHD): no hay stream directo;
    // se conserva la URL del embed y se marca para que el cliente lo distinga.
    if (outcome.metadata && outcome.metadata.webviewOnly) {
      track.url = outcome.url;
      track.isEmbed = true;
      track.isDownload = false;
      track.provider = outcome.provider;
      track.webviewOnly = true;
      track.headers = { ...(track.headers || {}), ...outcome.headers };
      track._metadata = outcome.metadata;
      return track;
    }
    track.url = outcome.url;
    track.isEmbed = false;
    track.isDownload = false;
    track.provider = outcome.provider;
    track.headers = { ...(track.headers || {}), ...outcome.headers };
    track._metadata = outcome.metadata; // Pass metadata for multi-track expansion
    // Reemplazar label genérico con el nombre real del proveedor resuelto
    if (outcome.provider && track.label) {
      const name = outcome.provider.charAt(0).toUpperCase() + outcome.provider.slice(1);
      if (/^Player\b/i.test(track.label) || /^(PelisPedia|OnlyPelis|GnulaHD)$/i.test(track.label)) {
        track.label = name;
      }
    }
    // If resolved URL is m3u8, parse master playlist for quality variants
    if (track.url && track.url.includes('.m3u8') && (!track.qualities || track.qualities.length === 0)) {
      const variants = await parseM3u8Variants(track.url, track.headers?.Referer);
      if (variants.length > 0) {
        track.qualities = variants.map(v => ({
          key: v.qualityLabel.replace('p', ''),
          label: v.qualityLabel,
          url: v.url,
          headers: track.headers || {},
          height: v.resolution ? parseInt(v.resolution.split('x')[1], 10) : null,
          bandwidth: v.bandwidth || null,
        }));
      }
    }
    this._log('track', 'resolved', track.provider, track.url);
    return track;
  }

  async _resolveUrl(url, timeoutMs = TRACK_TIMEOUT_MS) {
    let raced;
    try {
      raced = await Promise.race([
        resolveStream(url),
        waitTimeout(timeoutMs).then(() => null),
      ]);
    } catch (err) {
      // No supported resolver for this URL (direct/unknown stream): keep it as-is.
      if (err && err.code === ERROR_CODES.UNSUPPORTED_URL) return { unchanged: true };
      this._warn('resolver error', err.message);
      return { unavailable: true };
    }
    if (!raced) return { unchanged: true }; // timeout or null
    if (!raced.success || typeof raced.streamUrl !== 'string' || !raced.streamUrl.startsWith('http')) {
      return { unchanged: true };
    }
    // MEGA shared links must keep their key so the video proxy can decrypt the
    // stream server-side. The temporary userstorage URL alone has no key.
    let urlHost = '';
    try { urlHost = new URL(url).hostname; } catch {}
    if (raced.provider === 'mega' && /mega\.nz$/i.test(urlHost)) {
      return { url, headers: { 'User-Agent': 'Mozilla/5.0' }, provider: 'mega' };
    }
    const headers = { ...(raced.headers || {}) };
    if (Object.keys(headers).length === 0) headers['User-Agent'] = 'Mozilla/5.0';
    return { url: raced.streamUrl, headers, provider: raced.provider || null, metadata: raced.metadata || null };
  }

  // Sondeo para elegir entre varias opciones de servidor: resuelve la URL y
  // clasifica el resultado sin mutar nada.
  async probeUrl(url, timeoutMs = TRACK_TIMEOUT_MS) {
    const outcome = await this._resolveUrl(url, timeoutMs);
    if (outcome && typeof outcome.url === 'string') {
      return { status: 'resolved', url: outcome.url, headers: outcome.headers || {}, provider: outcome.provider };
    }
    if (outcome && outcome.unavailable) return { status: 'unavailable' };
    return { status: 'unchanged' };
  }

  _prioritizeTracks(tracks) {
    // Group by language first (Latino/DUB -> Castellano -> Sub), then by provider
    // preference (byse > okru > vidara) so a flaky vidara doesn't auto-open first.
    // Unavailable tracks (resolver failed) sink to the bottom of their language group.
    const RANK = { byse: 3, okru: 2, vidara: 1 };
    const langRank = (t) => {
      const q = (t && t.quality ? String(t.quality) : '').toUpperCase();
      if (q === 'DUB' || q === 'LAT' || q.indexOf('LATINO') >= 0) return 0;
      if (q === 'CAST' || q.indexOf('CASTELLANO') >= 0) return 1;
      return 2;
    };
    const rankOf = (t) => {
      if (t && t.available === false) return -1;
      // Webview-only por debajo de cualquier stream directo resuelto.
      if (t && t.webviewOnly) return 1;
      const p = (t && t.provider ? String(t.provider) : '').toLowerCase();
      return RANK[p] != null ? RANK[p] : 2;
    };
    return tracks.slice().sort((a, b) => {
      const la = langRank(a);
      const lb = langRank(b);
      if (la !== lb) return la - lb;
      return rankOf(b) - rankOf(a);
    });
  }

  _log(type, event, provider, streamUrl) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[EmbedResolver] ${type} ${event} [${provider || 'unknown'}] ${streamUrl || ''}`);
    }
  }

  _warn(msg, detail) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[EmbedResolver] ${msg} ${detail || ''}`);
    }
  }
}

module.exports = { EmbedResolverService };