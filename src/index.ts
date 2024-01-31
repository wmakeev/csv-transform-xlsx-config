/* eslint node/no-extraneous-import:0 */

import assert from 'assert'
import { parse } from 'csv-parse/sync'
import ExcelJS from 'exceljs'
import { fetch } from 'undici'
import {
  header as Header,
  HeadersTransformer,
  row as Row,
  RowsTransformerFactory
} from '@wmakeev/csv-transform'

import { mapperCodeByName, mappersByCode } from './mappers.js'
import {
  HeaderOperationConfig,
  ResourceConfig,
  ResourceType,
  RowOperationConfig
} from './types.js'

const headersWorksheetHeadersMap = {
  'Операция': 'operation',
  'Наименование': 'columnName',
  'Скрытый': 'hidden',
  'Новое наименование': 'newColumnName',
  'Колонка': 'columns'
} as const

const rowsWorksheetHeadersMap = {
  Операция: 'operation',
  Колонка: 'columnName',
  Преобразование: 'MAP_mapper',
  Заполнение: 'FILL_value',
  Выражение: 'expression'
} as const

const resourceWorksheetHeadersMap = {
  Тип: 'type',
  Описание: 'description',
  Переменная: 'variable',
  Значение: 'value'
} as const

const headersWorksheetOperationsMap = {
  Добавить: 'ADD',
  Переименовать: 'RENAME',
  Выбрать: 'SELECT'
} as const

const rowsWorksheetOperationsMap = {
  Преобразование: 'MAP',
  Заполнение: 'FILL',
  Трансформация: 'TRANSFORM',
  Фильтрация: 'FILTER'
} as const

const resoursesWorksheetTypeMap = {
  'Ссылка CSV': 'CSV_URL'
} as const

type HeaderOperationFields =
  (typeof headersWorksheetHeadersMap)[keyof typeof headersWorksheetHeadersMap]

type RowsOperationFields =
  (typeof rowsWorksheetHeadersMap)[keyof typeof rowsWorksheetHeadersMap]

type ResourceFields =
  (typeof resourceWorksheetHeadersMap)[keyof typeof resourceWorksheetHeadersMap]

type HeaderRowRecord = Record<HeaderOperationFields, unknown>

type RowRowRecord = Record<RowsOperationFields, unknown>

type ResourceRowRecord = Record<ResourceFields, unknown>

const headerOperationConfigCreatorByOperation: {
  [T in HeaderOperationConfig['operation']]: (
    rowRecord: HeaderRowRecord & { operation: T }
  ) => Extract<HeaderOperationConfig, { operation: T }>
} = {
  ADD: ({ operation, columnName, hidden }) => {
    assert.ok(typeof columnName === 'string')

    return {
      operation,
      columnName,
      hidden: typeof hidden === 'boolean' ? hidden : false
    }
  },

  RENAME: ({ operation, columnName, newColumnName }) => {
    assert.ok(
      typeof columnName === 'string',
      `Не корретно указано наименование колонки columnName - ${columnName}`
    )
    assert.ok(
      typeof newColumnName === 'string',
      `Не корретно указано наименование колонки newColumnName - ${newColumnName}`
    )

    return {
      operation,
      oldColumnName: columnName,
      newColumnName: newColumnName
    }
  },

  SELECT: ({ operation, columns }) => {
    return {
      operation,
      columns: (Array.isArray(columns) ? columns : [columns]).filter(
        col => typeof col === 'string' && col !== ''
      )
    }
  }
}

const rowOperationConfigCreatorByOperation: {
  [T in RowOperationConfig['operation']]: (
    rowRecord: RowRowRecord & { operation: T }
  ) => Extract<RowOperationConfig, { operation: T }>
} = {
  FILL: ({ operation, columnName, FILL_value }) => {
    assert.ok(typeof columnName === 'string')

    return {
      operation,
      columnName,
      value: FILL_value
    }
  },

  MAP: ({ operation, columnName, MAP_mapper }) => {
    assert.ok(typeof columnName === 'string')
    assert.ok(typeof MAP_mapper === 'string')

    const mapperCode =
      mapperCodeByName[MAP_mapper as keyof typeof mapperCodeByName]

    if (mapperCode === undefined) {
      throw new Error(`Преобразование не найдено - ${MAP_mapper}`)
    }

    return {
      operation,
      columnName,
      mapperCode: mapperCode
    }
  },

  TRANSFORM: ({ operation, columnName, expression }) => {
    assert.ok(typeof columnName === 'string')
    assert.ok(typeof expression === 'string')

    return {
      operation,
      columnName,
      expression
    }
  },

  FILTER: ({ operation, columnName, expression }) => {
    assert.ok(typeof columnName === 'string')
    assert.ok(typeof expression === 'string')

    return {
      operation,
      columnName,
      expression
    }
  }
}

const resourceRowConfigCreatorByResourceType: {
  [T in ResourceType]: (
    rowRecord: ResourceRowRecord & { type: T }
  ) => Extract<ResourceConfig, { type: T }>
} = {
  CSV_URL: ({ type, description, variable, value }) => {
    assert.ok(typeof variable === 'string')
    assert.ok(
      value != null &&
        typeof value === 'object' &&
        'hyperlink' in value &&
        typeof value.hyperlink === 'string'
    )

    return {
      type,
      description: typeof description === 'string' ? description : '',
      variable,
      value: value.hyperlink
    }
  }
}

const getRowRecord = (
  header: string[],
  headerMap: Record<string, string>,
  row: unknown[]
) => {
  const kvEntries = header.reduce((res, h, index) => {
    const hMapped = headerMap[h]

    if (hMapped === undefined) return res

    const val = res.get(hMapped)

    if (val !== undefined) {
      res.set(
        hMapped,
        Array.isArray(val) ? [...val, row[index]] : [val, row[index]]
      )
    } else {
      res.set(hMapped, row[index])
    }

    return res
  }, new Map<string, any>())

  const record = Object.fromEntries(kvEntries.entries())

  return record
}

const resourceLoaders: {
  [T in ResourceType]: (value: string) => Promise<unknown>
} = {
  CSV_URL: async url => {
    console.log(`Loading CSV resource - ${url}`)

    const matchTableCsv = await (await fetch(url)).text()

    const rows: string[][] = parse(matchTableCsv, {
      skip_empty_lines: true
    })

    return rows
  }
}

export async function createCsvTransformConfigFromXlsx(
  xlsxFile: string,
  constants: Record<string, unknown>
) {
  const workbook = new ExcelJS.Workbook()

  await workbook.xlsx.readFile(xlsxFile)

  //#region Headers
  const headersWorksheet = workbook.getWorksheet('Заголовки')

  const headersWorksheetRows = headersWorksheet?.getSheetValues() as unknown[][]

  const headersWorksheetHeaderRow = Array.from(headersWorksheetRows)[1]
    ?.slice(1)
    ?.map(h => String(h))

  assert.ok(headersWorksheetHeaderRow)

  const headersWorksheetRowRecords = Array.from(headersWorksheetRows)
    .slice(2)
    .map(row =>
      getRowRecord(
        headersWorksheetHeaderRow,
        headersWorksheetHeadersMap,
        row.slice(1)
      )
    )
    .filter(rec => {
      return typeof rec['operation'] === 'string'
    })

  const headerConfigs = headersWorksheetRowRecords.map(row => {
    const operation = row['operation']

    assert.ok(typeof operation === 'string')

    if (!(operation in headersWorksheetOperationsMap)) {
      throw new Error(`Неизвестаная операция заголовка - ${operation}`)
    }

    const operationCode =
      headersWorksheetOperationsMap[
        operation as keyof typeof headersWorksheetOperationsMap
      ]

    const config = headerOperationConfigCreatorByOperation[operationCode]({
      ...row,
      operation: operationCode
    } as any)

    return config
  })
  //#endregion

  //#region Rows
  const rowsWorksheet = workbook.getWorksheet('Строки')

  const rowsWorksheetRows = rowsWorksheet?.getSheetValues() as unknown[][]

  const rowsWorksheetHeaderRow = Array.from(rowsWorksheetRows)[1]
    ?.slice(1)
    ?.map(h => String(h))

  assert.ok(rowsWorksheetHeaderRow)

  const rowsWorksheetRowRecords = Array.from(rowsWorksheetRows)
    .slice(2)
    .map(row =>
      getRowRecord(
        rowsWorksheetHeaderRow,
        rowsWorksheetHeadersMap,
        row.slice(1)
      )
    )
    .filter(rec => typeof rec['operation'] === 'string')

  const rowConfigs = rowsWorksheetRowRecords.map(row => {
    const operation = row['operation']

    assert.ok(typeof operation === 'string')

    if (!(operation in rowsWorksheetOperationsMap)) {
      throw new Error(`Неизвестаная операция заголовка - ${operation}`)
    }

    const operationCode =
      rowsWorksheetOperationsMap[
        operation as keyof typeof rowsWorksheetOperationsMap
      ]

    const config = rowOperationConfigCreatorByOperation[operationCode]({
      ...row,
      operation: operationCode
    } as any)

    return config
  })
  //#endregion

  //#region Resources
  const resourcesWorksheet = workbook.getWorksheet('Ресурсы')

  const resourcesWorksheetRows =
    resourcesWorksheet?.getSheetValues() as unknown[][]

  const resourcesWorksheetHeaderRow = Array.from(resourcesWorksheetRows)[1]
    ?.slice(1)
    ?.map(h => String(h))

  assert.ok(resourcesWorksheetHeaderRow)

  const resourcesWorksheetRowRecords = Array.from(resourcesWorksheetRows)
    .slice(2)
    .map(row =>
      getRowRecord(
        resourcesWorksheetHeaderRow,
        resourceWorksheetHeadersMap,
        row.slice(1)
      )
    )
    .filter(rec => typeof rec['type'] === 'string')

  const resourseConfigs = resourcesWorksheetRowRecords.flatMap(row => {
    const resourceType = row['type']

    if (typeof resourceType !== 'string') {
      return []
    }

    if (!(resourceType in resoursesWorksheetTypeMap)) {
      throw new Error(`Неизвестаный тип ресурса - ${resourceType}`)
    }

    const resourceTypeCode =
      resoursesWorksheetTypeMap[
        resourceType as keyof typeof resoursesWorksheetTypeMap
      ]

    const config = resourceRowConfigCreatorByResourceType[resourceTypeCode]({
      ...row,
      type: resourceTypeCode
    } as any)

    return config
  })

  const resoursesEntries = await Promise.all(
    resourseConfigs.map(async ({ type, variable, value }) => {
      const val = await resourceLoaders[type](value)
      return [variable, val] as [string, unknown]
    })
  )

  const resourses = Object.fromEntries(resoursesEntries)
  //#endregion

  const headerRowTransforms: HeadersTransformer[] = []

  for (const headerConfig of headerConfigs) {
    const { operation } = headerConfig

    switch (operation) {
      case 'ADD': {
        headerRowTransforms.push(
          Header.add({
            columnName: headerConfig.columnName,
            hidden: headerConfig.hidden
          })
        )
        break
      }

      case 'RENAME': {
        headerRowTransforms.push(
          Header.rename({
            oldColumnName: headerConfig.oldColumnName,
            newColumnName: headerConfig.newColumnName
          })
        )
        break
      }

      case 'SELECT': {
        headerRowTransforms.push(
          Header.select({
            columns: headerConfig.columns
          })
        )
        break
      }

      default: {
        const _never: never = operation
        throw new Error(`Неизвестная перация с заголовком - ${_never}`)
      }
    }
  }

  const dataRowTransforms: RowsTransformerFactory[] = []

  for (const rowConfig of rowConfigs) {
    const { operation } = rowConfig

    switch (operation) {
      case 'FILL': {
        dataRowTransforms.push(
          Row.column.fill({
            columnName: rowConfig.columnName,
            value: rowConfig.value
          })
        )
        break
      }

      case 'MAP': {
        dataRowTransforms.push(
          Row.column.map({
            columnName: rowConfig.columnName,
            mapper: mappersByCode[rowConfig.mapperCode],
            arrIndex: 0
          })
        )
        break
      }

      case 'FILTER': {
        dataRowTransforms.push(
          Row.column.filter({
            columnName: rowConfig.columnName,
            expression: rowConfig.expression,
            constants: {
              ...constants,
              ...resourses
            }
          })
        )
        break
      }

      case 'TRANSFORM': {
        dataRowTransforms.push(
          Row.column.transform({
            columnName: rowConfig.columnName,
            expression: rowConfig.expression,
            constants: {
              ...constants,
              ...resourses
            }
          })
        )
        break
      }

      default: {
        const _never: never = operation
        throw new Error(`Неизвестная операция строкой - ${_never}`)
      }
    }
  }

  // const configWorksheet = workbook.getWorksheet('Настройки')
  // const testSourceWorksheet = workbook.getWorksheet('[Тест] Источник')
  // const testResultWorksheet = workbook.getWorksheet('[Тест] Результат')

  return {
    headerRowTransforms,
    dataRowTransforms
  }
}
