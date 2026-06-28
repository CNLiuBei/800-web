import { isJellyfinCompatPath } from '../../workers/api/src/route-matchers'

interface FetcherBinding {
  fetch(request: Request): Promise<Response>
}

interface Env {
  ASSETS: FetcherBinding
  API: FetcherBinding
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (isJellyfinCompatPath(path)) {
      return env.API.fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
}
