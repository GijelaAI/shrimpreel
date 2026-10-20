-- 健康检查每 5 分钟统计一次处理失败的支付回调
CREATE INDEX idx_payment_events_status ON payment_events(status, created_at);
