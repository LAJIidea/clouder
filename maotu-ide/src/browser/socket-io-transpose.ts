import { Socket, io } from "socket.io-client";
import { Emitter, Event, MessageTransport, MessageTransportProvider } from "open-collaboration-rpc";

export const SocketIoTransportProvider: MessageTransportProvider = {
  id: 'socket.io',
  createTransport: (url, headers) => {
    const socket = io(url, {
      extraHeaders: headers
    });
    const transport = new SocketIoTransport(socket);
    return transport;
  }
};

export class SocketIoTransport implements MessageTransport {

  readonly id = 'socket.io';

  private onDisconnectionEmitter = new Emitter<void>();

  get onDisconnect(): Event<void> {
    return this.onDisconnectionEmitter.event;
  }

  constructor(protected socket: Socket) {
    this.socket.on('disconnect', () => this.onDisconnectionEmitter.fire());
  }

  write(data: ArrayBuffer): void {
    this.socket.emit('message', data);
  }

  read(cb: (data: ArrayBuffer) => void): void {
    this.socket.on('message', cb);
  }

  dispose(): void {
    this.onDisconnectionEmitter.dispose();
    this.socket.close();
  }
}