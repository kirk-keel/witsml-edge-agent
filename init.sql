CREATE TABLE IF NOT EXISTS telemetry_batches (
    id SERIAL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rig_id VARCHAR(50) NOT NULL,
    well_id VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL
);
SELECT create_hypertable('telemetry_batches', 'timestamp', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS ai_decisions (
    id SERIAL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rig_id VARCHAR(50),
    well_id VARCHAR(50),
    declared_op VARCHAR(50),
    actual_state VARCHAR(50),
    is_ilt BOOLEAN,
    ilt_duration_seconds INT,
    confidence_score NUMERIC,
    justification TEXT
);
SELECT create_hypertable('ai_decisions', 'timestamp', if_not_exists => TRUE);

ALTER TABLE ai_decisions
    ADD COLUMN IF NOT EXISTS rig_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS well_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS declared_op VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_telemetry_batches_rig_time ON telemetry_batches (rig_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_rig_time ON ai_decisions (rig_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_is_ilt ON ai_decisions (is_ilt, timestamp DESC);

SELECT add_retention_policy('telemetry_batches', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('ai_decisions', INTERVAL '90 days', if_not_exists => TRUE);
