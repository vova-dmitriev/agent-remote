INSERT INTO attachment_blobs(owner_id,sha256,bytes)
SELECT DISTINCT ON(owner_id,descriptor->>'sha256') owner_id,descriptor->>'sha256',bytes FROM attachments
WHERE bytes IS NOT NULL AND substring(id,15,1)='5' AND (descriptor->>'sha256') ~ '^[a-f0-9]{64}$'
ON CONFLICT(owner_id,sha256) DO NOTHING;
UPDATE attachments a SET blob_sha256=a.descriptor->>'sha256',bytes=NULL
WHERE a.bytes IS NOT NULL AND substring(a.id,15,1)='5' AND EXISTS(SELECT 1 FROM attachment_blobs b WHERE b.owner_id=a.owner_id AND b.sha256=a.descriptor->>'sha256');
