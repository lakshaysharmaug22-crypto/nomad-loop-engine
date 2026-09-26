// In-memory fan-out of live events to WebSocket subscribers. Channels are run ids and sweep ids.
import { Injectable } from '@nestjs/common';
import type { RunEvent, SweepItem, Sweep } from '@nomad/contracts';
import { Subject } from 'rxjs';

export type LiveMessage =
  | { channel: string; kind: 'run'; event: RunEvent; seq: number }
  | { channel: string; kind: 'sweep'; item?: SweepItem; sweep: Pick<Sweep, 'id' | 'status'> };

@Injectable()
export class EventBus {
  readonly messages$ = new Subject<LiveMessage>();

  publish(m: LiveMessage) {
    this.messages$.next(m);
  }
}
