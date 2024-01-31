/* eslint node/no-extraneous-import:0 */

import { mappers } from '@wmakeev/csv-transform'

export const mappersByCode = {
  DECODE_HTML: mappers.DECODE_HTML.mapper
} as const

export const mapperCodeByName = {
  'Декодировать HTML': 'DECODE_HTML'
} as const
