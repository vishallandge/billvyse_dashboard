import { io } from 'socket.io-client';
import { looksSignedIn } from './session';
import { API_URL } from './api';

let socket = null;

/**
 * The shop-wide realtime socket.
 *
 * No token is passed any more: the handshake is an ordinary HTTP request, so the httpOnly
 * session cookie rides along with it once `withCredentials` is set, and the server reads it
 * there (see backend/realtime.js). The client never holds a credential.
 *
 * `as: 'shop'` picks which cookie the server should read — a shopkeeper who also has a
 * storefront session holds both, and guessing between them would sometimes authenticate
 * this socket as a customer. It selects a cookie and grants nothing on its own.
 */
export function getShopSocket() {
  // Cheap negative check only. The session cookie is unreadable here by design; this just
  // avoids opening a socket that is certain to be rejected, e.g. on the login screen.
  if (!looksSignedIn()) return null;

  if (!socket) {
    socket = io(API_URL, {
      withCredentials: true,
      query: { as: 'shop' },
      autoConnect: false,
    });
  }
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

export function disconnectShopSocket() {
  if (socket) {
    socket.disconnect();
  }
}
