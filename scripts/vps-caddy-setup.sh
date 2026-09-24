kdramas.auristv.dpdns.org {
	# Reverse proxy al servidor kdramas (PM2, puerto 3002)
	reverse_proxy localhost:3002 {
		# Streaming HLS: flushing inmediato para segmentos
		flush_interval -1
	}

	# Streaming: body grande para uploads/reportes
	request_body {
		max_size 50MB
	}

	# Headers de seguridad
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		-Server
	}

	# Compresión para JSON (Caddy evita binarios por content-type)
	encode zstd gzip
}
