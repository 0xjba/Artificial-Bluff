/** Where the live server is, for server-side fetches (the browser goes through the /api rewrite). */
export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8787'
