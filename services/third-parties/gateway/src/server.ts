import fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'

const app = fastify().withTypeProvider<ZodTypeProvider>()

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

app.get(
  '/ping',
  {
    schema: {
      response: {
        200: z.object({ message: z.string() }),
      },
    },
  },
  async () => {
    return { message: 'pong' }
  },
)

const port = Number(process.env.PORT) || 3333

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`🚀 HTTP server running on http://localhost:${port}`)
})
