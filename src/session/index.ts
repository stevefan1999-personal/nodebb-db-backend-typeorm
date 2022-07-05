import { SessionData, Store } from 'express-session'

export class SessionStore extends Store {
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
