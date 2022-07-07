export interface HashSetQueryable {
  setAdd(key: string, value: string | string[]): Promise<void>

  setsAdd(keys: string[], value: string | string[]): Promise<void>

  setRemove(key: string | string[], value: string | string[]): Promise<void>

  setsRemove(keys: string[], value: string): Promise<void>

  isSetMember(key: string, value: string): Promise<boolean>

  isSetMembers(key: string, values: string[]): Promise<boolean[]>

  isMemberOfSets(sets: string[], value: string): Promise<boolean[]>

  getSetMembers(key: string): Promise<string[]>

  getSetsMembers(keys: string[]): Promise<string[][]>

  setCount(key: string): Promise<number>

  setsCount(keys: string[]): Promise<number[]>

  setRemoveRandom(key: string): Promise<string>
}
