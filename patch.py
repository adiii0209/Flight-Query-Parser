import re

with open("app.py", "r", encoding="utf-8") as f:
    content = f.read()

# Replace the WS receive loop and history loading
old_ws_block = """    receive_thread = threading.Thread(target=_ws_receive_loop, daemon=True)
    receive_thread.start()

    recent_event_ids = OrderedDict()
    last_event_db_id = 0

    def should_deliver"""

new_ws_block = """    receive_thread = threading.Thread(target=_ws_receive_loop, daemon=True)
    receive_thread.start()

    recent_event_ids = OrderedDict()

    # Initialize last_event_db_id to the max event ID to prevent massive historic egress
    try:
        max_id = db.session.query(db.func.max(OwnershipRealtimeEvent.id)).scalar()
        last_event_db_id = int(max_id or 0)
    except Exception:
        db.session.rollback()
        last_event_db_id = 0

    def should_deliver"""

content = content.replace(old_ws_block, new_ws_block)

old_loop_block = """        last_ping = datetime.utcnow()
        while ws_alive["value"]:
            delivered = False

            # 1. In-process queue (used when Redis is unavailable)
            if not use_redis:
                try:
                    event_payload = listener.get(timeout=25)
                    if should_deliver(event_payload):
                        if not _send_realtime_ws_json(ws, event_payload):
                            break
                        delivered = True
                except queue.Empty:
                    pass

            # 2. Redis pubsub for ownership events
            if ownership_pubsub is not None:
                try:
                    message = ownership_pubsub.get_message(timeout=0.1)
                    if message and message.get("data"):
                        event_payload = message["data"]
                        if isinstance(event_payload, str):
                            try:
                                event_payload = json.loads(event_payload)
                            except Exception:
                                event_payload = None
                        if event_payload and should_deliver(event_payload):
                            if not _send_realtime_ws_json(ws, event_payload):
                                break
                            delivered = True
                except Exception:
                    break

            # 3. Redis pubsub for ticket events
            if ticket_pubsub is not None:
                try:
                    message = ticket_pubsub.get_message(timeout=0.1)
                    if message and message.get("data"):
                        event_payload = message["data"]
                        if isinstance(event_payload, str):
                            try:
                                event_payload = json.loads(event_payload)
                            except Exception:
                                event_payload = None
                        if event_payload and should_deliver(event_payload):
                            if not _send_realtime_ws_json(ws, event_payload):
                                break
                            delivered = True
                except Exception:
                    break

            # 4. Heartbeat ping to client
            if not delivered and (datetime.utcnow() - last_ping).total_seconds() >= 25:"""

new_loop_block = """        last_ping = datetime.utcnow()
        while ws_alive["value"]:
            delivered = False

            try:
                # 1. Block on the local in-memory listener queue.
                # If Redis is disabled, events arrive here.
                # We use a short timeout so we can still poll Redis pubsub.
                event_payload = listener.get(timeout=0.5)
                if should_deliver(event_payload):
                    if not _send_realtime_ws_json(ws, event_payload):
                        break
                    delivered = True
            except queue.Empty:
                pass

            # 2. Fallback DB polling (only if Redis is disabled)
            if not use_redis and not delivered:
                try:
                    last_event_db_id = _deliver_pending_ownership_events(ws, last_event_db_id, should_deliver)
                except Exception:
                    pass

            # 3. Redis pubsub for ownership events
            if ownership_pubsub is not None:
                try:
                    message = ownership_pubsub.get_message(ignore_subscribe_messages=True, timeout=0.01)
                    if message and message.get("data"):
                        event_payload = message["data"]
                        if isinstance(event_payload, str):
                            try:
                                event_payload = json.loads(event_payload)
                            except Exception:
                                event_payload = None
                        if event_payload and should_deliver(event_payload):
                            if not _send_realtime_ws_json(ws, event_payload):
                                break
                            delivered = True
                except Exception:
                    break

            # 4. Redis pubsub for ticket events
            if ticket_pubsub is not None:
                try:
                    message = ticket_pubsub.get_message(ignore_subscribe_messages=True, timeout=0.01)
                    if message and message.get("data"):
                        event_payload = message["data"]
                        if isinstance(event_payload, str):
                            try:
                                event_payload = json.loads(event_payload)
                            except Exception:
                                event_payload = None
                        if event_payload and should_deliver(event_payload):
                            if not _send_realtime_ws_json(ws, event_payload):
                                break
                            delivered = True
                except Exception:
                    break

            # 5. Heartbeat ping to client
            if not delivered and (datetime.utcnow() - last_ping).total_seconds() >= 25:"""

content = content.replace(old_loop_block, new_loop_block)

with open("app.py", "w", encoding="utf-8") as f:
    f.write(content)
print("app.py websocket loop updated successfully.")
