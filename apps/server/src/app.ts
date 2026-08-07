import Fastify from 'fastify'

/**
 * Builds the Fastify application without listening, so tests can use `app.inject`.
 * The HTTP/API seam lives here: all future API routes register onto this app.
 */
export function buildApp() {
  const app = Fastify({ logger: false })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
