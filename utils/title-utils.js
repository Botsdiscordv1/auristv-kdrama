function isGenericEpisodeName(name) {
  return !name || /^episodio\s*\d+$/i.test(name) || /^episode\s*\d+$/i.test(name) || !name.trim();
}

const splitSyl = (t) => t
  .replace(/(dai){2,}/gi, (m) => m.match(/dai/gi).join(" "))
  .replace(/(suk){2,}/gi, (m) => m.match(/suk/gi).join(" "));

function cleanTMDBTitle(title, seasonCleanRe) {
  return title
    ? title
        .replace(seasonCleanRe, "")
        .replace(/\s*\((?:TV|Movie|Film|dub|sub)\)\s*$/i, "")
        .trim()
    : title;
}

module.exports = {
  isGenericEpisodeName,
  splitSyl,
  cleanTMDBTitle,
};
