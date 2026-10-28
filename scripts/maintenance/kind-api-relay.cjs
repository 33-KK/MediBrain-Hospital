/** TLS passthrough for the existing local kind API; publish only on 127.0.0.1. */
const net = require('node:net');
const server = net.createServer((client) => {
  const upstream = net.connect(6443, 'medibrain-prod-control-plane');
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  client.pipe(upstream).pipe(client);
});
server.listen(6443, '0.0.0.0');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
