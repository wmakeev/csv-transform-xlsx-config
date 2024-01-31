import {
  ChunkTransform,
  FlattenTransform,
  createCsvTransformer
} from '@wmakeev/csv-transform'
import { parse } from 'csv-parse'
import { stringify } from 'csv-stringify'
import assert from 'node:assert'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import test from 'node:test'

import { createCsvTransformConfigFromXlsx } from '../src/index.js'

test('teremopt config', async () => {
  const globalEnv = {
    'env:TRANSFORM_START_DATE': new Date()
  }

  const transformContextConstants = {
    ...globalEnv
  }

  const xlsxConfigFile = path.join(
    process.cwd(),
    'test/cases/teremopt-config.xlsx'
  )

  const config = await createCsvTransformConfigFromXlsx(
    xlsxConfigFile,
    transformContextConstants
  )

  const csvTransformer = createCsvTransformer(config)

  await pipeline([
    createReadStream(
      path.join(process.cwd(), 'test/cases/teremopt-sample.csv'),
      {
        highWaterMark: 16 * 1024,
        encoding: 'utf8'
      }
    ),

    parse({ bom: true }),

    new ChunkTransform({ batchSize: 10 }),

    csvTransformer as any,

    new FlattenTransform(),

    stringify({ bom: true }),

    createWriteStream(
      path.join(process.cwd(), '__temp/test-out/teremopt-result.csv'),
      'utf8'
    )
  ])

  const csvActual = await readFile(
    path.join(process.cwd(), '__temp/test-out/teremopt-result.csv'),
    'utf8'
  )

  const csvExpected = await readFile(
    path.join(process.cwd(), 'test/cases/teremopt-result.csv'),
    'utf8'
  )

  assert.equal(csvActual, csvExpected)
})
