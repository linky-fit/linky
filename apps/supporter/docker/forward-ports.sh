#!/bin/sh
# Each SUPPORTER_FORWARD_PORTS entry "<port>=<host>:<port>" makes localhost:<port>
# reach <host>:<port>, then the command runs. socat's stderr is dropped: every
# websocket a relay closes would log "connection reset by peer".
set -eu
for forward in ${SUPPORTER_FORWARD_PORTS:-}; do
  socat "TCP-LISTEN:${forward%%=*},bind=127.0.0.1,fork,reuseaddr" "TCP:${forward#*=}" 2>/dev/null &
done
exec "$@"
