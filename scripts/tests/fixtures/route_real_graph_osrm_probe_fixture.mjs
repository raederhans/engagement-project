import { readFileSync } from 'node:fs';
import http from 'node:http';

const [mode, portText, payloadPath] = process.argv.slice(2);
const port = Number(portText);
if (mode === 'early-exit') process.exit(23);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) process.exit(24);

let body;
if (mode === 'canned') body = readFileSync(payloadPath, 'utf8');
else if (mode === 'non-json') body = 'not-json';
else if (mode === 'error-json') body = JSON.stringify({ code: 'NoRoute', routes: [], waypoints: [] });
else process.exit(25);

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(body);
});
server.once('error', () => process.exit(26));
server.listen({ host: '127.0.0.1', port, exclusive: true });
process.once('SIGTERM', () => server.close(() => process.exit(0)));
