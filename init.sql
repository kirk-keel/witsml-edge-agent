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
