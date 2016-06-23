import Rx from 'rxjs'
import { createServer as create_server } from 'http'
import { request as https_request } from 'https'
import url from 'url'

const PORT = process.env.PORT || 3000

function rx_request (options, e) {
  return Rx.Observable.create(observer => {
    let req = https_request(options, res => {
      res.on('data', chunk => {
        e.chunk = chunk
        observer.next(e)
      })
      res.on('end', () => {
        observer.complete()
      })
    })
    req.on('error', error => {
      observer.error(error)
    })
    req.end()
  }).reduce((e, chunk) => {
    e.request.body = e.request.body || ''
    e.request.body += e.chunk.toString('utf8')
    return e
  }, e)
}

function body_parser (e) {
  return Rx.Observable.create(observer => {
    e.req.on('data', observer.next.bind(observer))
    e.req.on('end', observer.complete.bind(observer))
  }).reduce((e, chunk) => {
    e.request.body = e.body || ''
    e.request.body += chunk
    return e
  }, e)
}

function query_parser (e) {
  return Rx.Observable.create(observer => {
    let query_string = e.req.url.split('?')[1]
    if (query_string) {
      let query_string_array = query_string.split('&')
      e.query_string = query_string_array.reduce((acc, q) => {
        let query = q.split('=')
        acc[query[0]] = query[1]
        return acc
      }, {})
      observer.next(e)
    } else {
      e.query_string = {}
      observer.next(e)
    }
  })
}

function router (e) {
  return Rx.Observable.create(observer => {
    if (e.req.url === '/') {
      e.status = 200
      e.body = 'gg'
      observer.next(e)
    } else {
      observer.next(e)
    }
  }).flatMap(e => {
    let options = {
      ...url.parse('https://api.github.com/users'),
      headers: {
        'User-Agent': 'Awesome-Nukr'
      }
    }
    return rx_request(options, e)
  }).map(e => {
    e.body = e.request.body
    return e
  })
}

function main (sources) {
  let sinks = {}
  sinks.HTTP = sources
      .flatMap(body_parser)
      .flatMap(query_parser)
      .flatMap(router)
  sinks.LOG = sources
  return sinks
}

const status_default_message = {
  '200': 'ok',
  '404': 'not found'
}

function http_driver (request_) {
  request_.subscribe(e => {
    if (e.status) {
      if (e.body) {
        e.headers = {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(e.body)
        }
      } else {
        e.body = status_default_message[e.status]
        e.headers = {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(e.body)
        }
      }
    } else {
      if (e.body) {
        e.status = 200
        e.headers = {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(e.body)
        }
      } else {
        e.body = 'not found'
        e.status = 404
        e.headers = {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(e.body)
        }
      }
    }
    e.res.writeHead(e.status, e.headers)
    e.res.write(e.body, 'utf8')
    e.res.end()
  })
  const http_source = new Rx.Subject()
  const server = create_server((req, res) => {
    http_source.next({req, res})
  })

  server.on('close', () => {
    http_source.complete()
  })
  server.listen(PORT, () => console.log(`server listening port ${PORT}`))
  return http_source.map(e => {
    e.request = {}
    e.response = {}
    e.headers = {}
    return e
  })
}

function log_driver (request_) {
  request_.subscribe(e => {
    console.log(`log_effect request to ${decodeURIComponent(e.req.url)}`)
  })
  return new Rx.Subject()
}

function run (mainFn, drivers) {
  Object.keys(drivers)
    .forEach(key => {
      const proxy_source = new Rx.Subject()
      const sinks = main(proxy_source)
      const source = drivers[key](sinks[key])
      source.subscribe(e => proxy_source.next(e))
    })
}

const drivers = {
  HTTP: http_driver,
  LOG: log_driver
}

run(main, drivers)


