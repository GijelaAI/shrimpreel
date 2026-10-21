-- 成片公开分享：share_id 是公开链接 /v/<share_id> 里的随机串（停止分享时清空，再次分享换新串，旧链接永久失效）。
-- share_poster_key 是分享封面（浏览器截帧生成的 1200×630 JPEG，放在 outputs/<user_id>/ 下，随成片一起删除）
ALTER TABLE generations ADD COLUMN share_id TEXT;
ALTER TABLE generations ADD COLUMN share_poster_key TEXT;
ALTER TABLE generations ADD COLUMN shared_at TEXT;
CREATE UNIQUE INDEX idx_generations_share ON generations(share_id) WHERE share_id IS NOT NULL;
