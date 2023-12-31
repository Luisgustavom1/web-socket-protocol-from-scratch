import { createServer } from "http";
import crypto from "crypto";

const PORT = 1337;
const WEB_SOCKET_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SEVEN_BITS_INTEGER_MARKER = 125;
const SIXTEEN_BITS_INTEGER_MARKER = 126;
const SIXTY_FOUR_BITS_INTEGER_MARKER = 127;

const MAXIMUM_SIXTEEN_BITS_INTEGER = 2 ** 16; // 65536
const MASK_KEY_BYTES_LENGTH = 4;
const OPCODE_TEXT = 0x01; // 1 bit in binary

// parseInt("10000000", 2) -> 128
const FIRST_BIT = 128;

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end('hey there');
}).listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`)
});

function onSocketUpgrade(req, socket, head) {
  const { 'sec-websocket-key': webClientSocketKey } = req.headers;

  const headers = prepareHandShakeHeaders(webClientSocketKey);
  
  socket.write(headers);
  socket.on("readable", () => onSocketReadable(socket));
  socket.on("close", () => {
    console.log("server closed");
  });
}

function prepareHandShakeHeaders(key) {
  const acceptKey = createSocketAccept(key);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
  ].map(l => l.concat('\r\n'));
  return headers.join('');
}

function createSocketAccept(key) {
  const shasum = crypto.createHash("sha1");
  return shasum.update(key + WEB_SOCKET_MAGIC_STRING).digest("base64");
}

function onSocketReadable(socket) {
  // consume optcode (first byte)
  socket.read(1);

  const [markerAndPayloadLength] = socket.read(1);
  // Because the first bit is always 1 for the client-to-server messages
  // you can subtract one bit (128 or 1000000)
  //from the second byte to get rid of the MASK bit
  const lengthIndicatorInBits = markerAndPayloadLength - FIRST_BIT;
  let messageLength = 0;

  if (lengthIndicatorInBits <= SEVEN_BITS_INTEGER_MARKER) {
    messageLength = lengthIndicatorInBits;
  } else if (lengthIndicatorInBits === SIXTEEN_BITS_INTEGER_MARKER) {
    // unsigned 16-bit integer [0 - 65k] - 2 ** 16
    messageLength = socket.read(2).readUint16BE(0);
  } else {
    throw new Error("your message is too long! We don't handle 64-bit message");
  }

  const mask = socket.read(MASK_KEY_BYTES_LENGTH);
  const encodedMessage = socket.read(messageLength);
  const decodedMessage = unmaskData(encodedMessage, mask);

  const data = JSON.parse(decodedMessage.toString());
  const msg = JSON.stringify({
    message: data,
    at: new Date().toISOString(),
  })
  console.log("message received: ", data);
  sendMessage(msg, socket);
}

const fillWithEightZeros = (b) => b.padStart(8, "0");
const toBinary = (dec) => fillWithEightZeros(dec.toString(2))
const binaryToDecimal = (b) => parseInt(b, 2);
const getCharFromBinary = (n) => String.fromCharCode(binaryToDecimal(toBinary(n)));

function unmaskData(encodedBuffer, mask) {
  const finalBuffer = Buffer.from(encodedBuffer);
  for (let i = 0; i < encodedBuffer.length; i++) {
    finalBuffer[i] = encodedBuffer[i] ^ mask[i % 4];

    const logger = {
      unmaskingCal: `${toBinary(encodedBuffer[i])} ^ ${toBinary(mask[i % 4])} = ${toBinary(finalBuffer[i])}`,
      decoded: String.fromCharCode(finalBuffer[i]),
    }
    console.log(logger);
  }
  return finalBuffer;
}

function sendMessage(msg, socket) {
  const dataFrameBuffer = prepareMessage(msg);
  socket.write(dataFrameBuffer);
}

function prepareMessage(message) {
  const msg = Buffer.from(message);
  const messageSize = msg.length;

  let dataFrameBuffer;

  // 0x80 === 128 in binary
  // 10000000
  const firstByte = 0x80 | OPCODE_TEXT; // single frame + text

  if (messageSize <= SEVEN_BITS_INTEGER_MARKER) {
    const bytes = [firstByte];
    dataFrameBuffer = Buffer.from(bytes.concat(messageSize));
  } else if (messageSize <= MAXIMUM_SIXTEEN_BITS_INTEGER) {
    const offset = 4;
    const target = Buffer.allocUnsafe(offset); 
    target[0] = firstByte;
    target[1] = SIXTEEN_BITS_INTEGER_MARKER | 0x0 // just to know the mask;

    target.writeUint16BE(messageSize, 2); // content length is 2 bytes
    dataFrameBuffer = target;
    
    // alloc 4 bytes
    // [0] -> 129 - 10000001 - 0x80 = 1 bit for FIN + 1 bit for opcode
    // [1] -> 126 - 01111110 - 0x7E = 0 bit for mask + 7 bits for payload length (126)
    // [2] -> 1   - 8 bits for payload length (126)
    // [3] -> 108 - 8 bits for payload length (126)
    // [4 - ...] -> payload data
  } else {
    throw new Error("message too long :(");
  }
  const totalLength = dataFrameBuffer.byteLength + messageSize;
  const dataFrameResponse = concat([dataFrameBuffer, msg], totalLength);
  return dataFrameResponse;
}

function concat(bufferList, totalLength) {
  const target = Buffer.allocUnsafe(totalLength);
  let offset = 0
  for (const buffer of bufferList) {
    target.set(buffer, offset);
    offset += buffer.length;
  }
  return target;
}

server.on("upgrade", onSocketUpgrade);

const errorEvents = ['uncaughtException', 'unhandledRejection'];
errorEvents.forEach((event) => {
  process.on(event, (err) => {
    console.error(`something bad happened! event: ${event}, error: ${err.stack || err}`);
  })
})