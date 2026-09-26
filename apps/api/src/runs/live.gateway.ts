// Live stream over Socket.IO (namespace /live). Clients emit `subscribe` with a run or sweep id and
// receive `run-event` / `sweep-item` messages for it. Each run event carries its sequence number, so
// a client that loaded the event log over REST can skip what it already has.
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer, type OnGatewayInit } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { EventBus } from '../events.bus';

@WebSocketGateway({ namespace: '/live', cors: { origin: process.env.CORS_ORIGIN ?? '*' } })
export class LiveGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;

  constructor(private readonly bus: EventBus) {}

  afterInit() {
    this.bus.messages$.subscribe((m) => {
      if (m.kind === 'run') this.server.to(m.channel).emit('run-event', { runId: m.channel, seq: m.seq, event: m.event });
      else this.server.to(m.channel).emit('sweep-item', { sweepId: m.channel, status: m.sweep.status, item: m.item });
    });
  }

  @SubscribeMessage('subscribe')
  subscribe(@ConnectedSocket() client: Socket, @MessageBody() channel: string) {
    if (typeof channel !== 'string' || channel.length > 80) return { error: 'invalid channel' };
    client.join(channel);
    return { subscribed: channel };
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() channel: string) {
    client.leave(channel);
    return { unsubscribed: channel };
  }
}
