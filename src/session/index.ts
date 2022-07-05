import { SessionData, Store } from 'express-session'
import { DataSource } from 'typeorm'

export class SessionStore extends Store {
  constructor(private readonly dataSource: DataSource) {
    super()
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    throw 'not implemented'
  }

  get(
    sid: string,
    callback: (err: any, session?: SessionData | null) => void,
  ): void {
    throw 'not implemented'
  }

  set(sid: string, session: SessionData, callback?: (err?: any) => void): void {
    throw 'not implemented'
  }
}
