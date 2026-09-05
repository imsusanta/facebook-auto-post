-- Preserve unknown historical attribution rather than guessing a customer's page.
CREATE FUNCTION autopost_timestamp(value text) RETURNS timestamptz
LANGUAGE plpgsql AS $$ BEGIN RETURN value::timestamptz; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;

ALTER TABLE scheduled_posts ADD COLUMN status text NOT NULL DEFAULT 'pending',
 ADD COLUMN scheduled_at timestamptz, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN processing_at timestamptz;
UPDATE scheduled_posts SET status=coalesce(data->>'status','pending'), scheduled_at=autopost_timestamp(data->>'scheduledAt'),
 created_at=coalesce(autopost_timestamp(data->>'createdAt'),now()), processing_at=autopost_timestamp(data->>'processingAt');
ALTER TABLE scheduled_posts ADD CONSTRAINT scheduled_status_valid CHECK(status IN ('pending','processing','completed','failed','needs_review')),
 ADD CONSTRAINT scheduled_payload_identity CHECK((data->>'id') IS NOT DISTINCT FROM id AND (data->>'facebookPageId') IS NOT DISTINCT FROM facebook_page_id AND (data->>'status') IS NOT DISTINCT FROM status);
CREATE INDEX scheduled_due ON scheduled_posts(workspace_id,scheduled_at,created_at) WHERE status='pending';
CREATE INDEX scheduled_processing ON scheduled_posts(processing_at) WHERE status='processing';

ALTER TABLE post_history ADD COLUMN facebook_page_id text, ADD COLUMN occurred_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN legacy_unattributed boolean NOT NULL DEFAULT false;
UPDATE post_history h SET facebook_page_id=p.id FROM facebook_pages p
 WHERE h.workspace_id=p.workspace_id AND h.data->>'facebookPageId'=p.id;
UPDATE post_history SET legacy_unattributed=(facebook_page_id IS NULL),
 occurred_at=coalesce(autopost_timestamp(data->>'timestamp'),now());
ALTER TABLE post_history ADD CONSTRAINT history_page_owner FOREIGN KEY(workspace_id,facebook_page_id) REFERENCES facebook_pages(workspace_id,id),
 ADD CONSTRAINT history_page_required CHECK(facebook_page_id IS NOT NULL OR legacy_unattributed),
 ADD CONSTRAINT history_payload_page CHECK(legacy_unattributed OR (data->>'facebookPageId') IS NOT DISTINCT FROM facebook_page_id);
CREATE INDEX history_workspace_time ON post_history(workspace_id,occurred_at DESC,id);
CREATE INDEX history_page_time ON post_history(workspace_id,facebook_page_id,occurred_at DESC);
CREATE INDEX media_workspace_time ON media_assets(workspace_id,created_at DESC);
CREATE INDEX audit_workspace_time ON audit_logs(workspace_id,created_at DESC);

ALTER TABLE webhook_events ADD COLUMN facebook_page_id text;
UPDATE webhook_events SET facebook_page_id=(data->>'payload')::jsonb->>'pageId';
ALTER TABLE webhook_events ALTER COLUMN facebook_page_id SET NOT NULL,
 ADD CONSTRAINT webhook_page_owner FOREIGN KEY(workspace_id,facebook_page_id) REFERENCES facebook_pages(workspace_id,id),
 ADD CONSTRAINT webhook_payload_page CHECK(((data->>'payload')::jsonb->>'pageId') IS NOT DISTINCT FROM facebook_page_id);
CREATE INDEX webhook_workspace_page ON webhook_events(workspace_id,facebook_page_id,created_at DESC);

CREATE FUNCTION autopost_immutable_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.id IS DISTINCT FROM OLD.id THEN
   RAISE EXCEPTION 'Record ownership and identity are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['facebook_pages','scheduled_posts','post_history','templates','categories','media_assets','webhook_events'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_owner BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION autopost_immutable_owner()',name);
 END LOOP;
END $$;
CREATE FUNCTION autopost_immutable_page() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.facebook_page_id IS DISTINCT FROM OLD.facebook_page_id THEN
   RAISE EXCEPTION 'Post/job destination is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_destination BEFORE UPDATE ON scheduled_posts FOR EACH ROW EXECUTE FUNCTION autopost_immutable_page();
CREATE TRIGGER immutable_destination BEFORE UPDATE ON post_history FOR EACH ROW EXECUTE FUNCTION autopost_immutable_page();
CREATE TRIGGER immutable_destination BEFORE UPDATE ON webhook_events FOR EACH ROW EXECUTE FUNCTION autopost_immutable_page();
DROP FUNCTION autopost_timestamp(text);
