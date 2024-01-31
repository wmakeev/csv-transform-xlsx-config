export type HeaderOperationConfig =
  | {
      operation: 'ADD'
      columnName: string
      hidden: boolean
    }
  | {
      operation: 'RENAME'
      oldColumnName: string
      newColumnName: string
    }
  | {
      operation: 'SELECT'
      columns: string[]
    }

export type FieldMapperName = 'DECODE_HTML'

export type RowOperationConfig =
  | {
      operation: 'MAP'
      columnName: string
      mapperCode: FieldMapperName
    }
  | {
      operation: 'FILL'
      columnName: string
      value: unknown
    }
  | {
      operation: 'TRANSFORM'
      columnName: string
      expression: string
    }
  | {
      operation: 'FILTER'
      columnName: string
      expression: string
    }

export type ResourceType = 'CSV_URL'

export type ResourceConfig = {
  type: ResourceType
  description?: string
  variable: string
  value: string
}
