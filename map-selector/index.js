import http from 'http'

import download from '../lib/download.js'

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html')
    res.end(
      await import('fs/promises').then((fs) =>
        fs.readFile('./map-selector/index.html'),
      ),
    )
    return
  }
  if (req.method === 'POST' && req.url === '/download') {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', async () => {
      try {
        const { bbox, maxzoom, styleUrl, accessToken } = JSON.parse(body)

        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="map-package.smp"',
        )

        const downloadStream = download({
          bbox,
          maxzoom,
          styleUrl,
          accessToken,
        })

        downloadStream.pipe(res)

        downloadStream.on('error', (error) => {
          console.error('Download error:', error)
          res.statusCode = 500
          res.end()
        })
      } catch (error) {
        console.error('Server error:', error)
        res.statusCode = 500
        res.end()
      }
    })
  } else {
    res.statusCode = 404
    res.end()
  }
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
