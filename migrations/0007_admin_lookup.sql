-- 后台订单详情时间线、用户详情审计记录的按对象查询
CREATE INDEX idx_payment_events_order ON payment_events(order_id, created_at);
CREATE INDEX idx_admin_audit_target ON admin_audit(target_type, target_id, created_at);
CREATE INDEX idx_ledger_ref ON credit_ledger(ref_id);
