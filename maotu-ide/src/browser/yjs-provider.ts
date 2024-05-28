import * as types from "open-collaboration-protocol";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { Disposable } from "@theia/core";

import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { Observable } from "lib0/observable";

export interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

export class OpenCollabYjsProvider extends Observable<string> implements Disposable {

  private connection: types.ProtocolBroadcastConnection;
  private doc: Y.Doc;
  private awanreness: awarenessProtocol.Awareness;
  private synced = false;

  constructor(connection: types.ProtocolBroadcastConnection, doc: Y.Doc, awareness: awarenessProtocol.Awareness) {
    super();
    this.connection = connection;
    this.doc = doc;
    this.awanreness = this.awanreness;
    this.doc.on('update', this.yjsUpdateHandler.bind(this));
    this.awanreness.on('update', this.yjsAwarenessUpdateHandler.bind(this));
  
    connection.sync.onDataUpdate(this.ocpDataUpdateHandler.bind(this));
    connection.sync.onAwarenessUpdate(this.ocpDataUpdateHandler.bind(this));
    connection.sync.onAwarenessQuery(this.ocpAwarenessQueryHandler.bind(this));
  }

  private ocpDataUpdateHandler(origin: string, update: string): void {
    const decoder = this.decodeBase64(update);
    const encoder = encoding.createEncoder();
    const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, origin);
    if (syncMessageType == syncProtocol.messageYjsSyncStep2 && !this.synced) {
      // todo handler room syncing (might not be necessary)
    } else if (syncMessageType == syncProtocol.messageYjsSyncStep1) {
      this.connection.sync.dataUpdate(origin, this.encodeBase64(encoder));
    }
  }


  private ocpAwarenessQueryHandler(origin: string, update: string): void {
    const decoder = this.decodeBase64(update)
    awarenessProtocol.applyAwarenessUpdate(this.awanreness, decoding.readVarUint8Array(decoder), origin);
  }

  private yjsUpdateHandler(update: Uint8Array, origin: unknown): void {
    if (origin !== this) {
      const encoder = encoding.createEncoder();
      syncProtocol.writeUpdate(encoder, update);
      this.connection.sync.dataUpdate(this.encodeBase64(encoder));
    }
  }

  private yjsAwarenessUpdateHandler(changed: AwarenessChange): void {
    const changedClients = changed.added.concat(changed.updated).concat(changed.removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awanreness, changedClients));
    this.connection.sync.awarenessUpdate(this.encodeBase64(encoder));
  }

  connect(): void {
    // write sync step 1
    const encoderSync = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoderSync, this.doc);
    this.connection.sync.dataUpdate(this.encodeBase64(encoderSync));
    // broadcast local state
    const encoderState = encoding.createEncoder();
    syncProtocol.writeSyncStep2(encoderState, this.doc);
    this.connection.sync.dataUpdate(this.encodeBase64(encoderState));
    // query awareness info
    const encoderAwareness = encoding.createEncoder();
    encoding.writeVarUint8Array(
      encoderAwareness,
      awarenessProtocol.encodeAwarenessUpdate(this.awanreness, [
        this.doc.clientID
      ])
    );
    this.connection.sync.awarenessUpdate(this.encodeBase64(encoderAwareness));
  }

  dispose(): void {
    awarenessProtocol.removeAwarenessStates(this.awanreness, [this.doc.clientID], 'client disconnected');
  }

  private encodeBase64(encoder: encoding.Encoder): string {
    return Buffer.from(encoding.toUint8Array(encoder)).toString('base64');
  }

  private decodeBase64(data: string): decoding.Decoder {
    return decoding.createDecoder(Buffer.from(data, 'base64'));
  }
}