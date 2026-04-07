DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'participant_devices_device_uuid_key'
    ) THEN
        ALTER TABLE participant_devices
        ADD CONSTRAINT participant_devices_device_uuid_key UNIQUE (device_uuid);
    END IF;
END $$;
