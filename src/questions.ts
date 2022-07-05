import * as nconf from 'nconf'

export const questions = [
  {
    default: nconf.get('typeorm:type') || 'sqlite',
    description: 'Database Type',
    name: 'typeorm:type',
  },
  {
    default: nconf.get('typeorm:host') || '127.0.0.1',
    description: 'Host IP or address of your PostgreSQL instance',
    name: 'typeorm:host',
  },
  {
    default: nconf.get('typeorm:port') || 5432,
    description: 'Host port of your PostgreSQL instance',
    name: 'typeorm:port',
  },
  {
    default: nconf.get('typeorm:username') || '',
    description: 'PostgreSQL username',
    name: 'typeorm:username',
  },
  {
    before(value?: string): string {
      return value ?? nconf.get('typeorm:password') ?? ''
    },
    default: nconf.get('typeorm:password') || '',
    description: 'Password of your PostgreSQL database',
    hidden: true,
    name: 'typeorm:password',
  },
  {
    default: nconf.get('typeorm:database') || 'nodebb',
    description: 'PostgreSQL database name',
    name: 'typeorm:database',
  },
  {
    default: nconf.get('typeorm:ssl') || false,
    description: 'Enable SSL for PostgreSQL database access',
    name: 'typeorm:ssl',
  },
]
