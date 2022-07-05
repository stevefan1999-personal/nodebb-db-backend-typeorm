export interface HashQueryable {
  setObject(key: string | string[], data: { [key: string]: any }): Promise<void>

  setObjectBulk(
    ...args: [key: string, data: { [key: string]: any }][]
  ): Promise<void>

  setObjectField(key: string, field: string, value: any): Promise<void>

  getObject(key: string, fields: string[]): Promise<any>

  getObjects(keys: string[], fields: string[]): Promise<any[]>

  getObjectField(key: string, field: string): Promise<any>

  getObjectFields(key: string, fields: string[]): Promise<any[]>

  getObjectsFields(
    keys: string[],
    fields: string[],
  ): Promise<{ [key: string]: any }>

  getObjectKeys(key: string): Promise<string[]>

  getObjectValues(key: string): Promise<any[]>

  isObjectField(key: string, field: string): Promise<boolean>

  isObjectFields(key: string, fields: string[]): Promise<boolean[]>

  deleteObjectField(key: string, field: string): Promise<void>

  deleteObjectFields(key: string, fields: string[]): Promise<void>

  incrObjectField(key: string, field: string): Promise<number>

  decrObjectField(key: string, field: string): Promise<number>

  incrObjectFieldBy(key: string, field: string, value: number): Promise<number>

  incrObjectFieldByBulk(
    data: [key: string, batch: [field: string, value: number][]][],
  ): Promise<number | number[]>
}
