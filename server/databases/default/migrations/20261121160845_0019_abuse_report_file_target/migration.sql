CREATE INDEX `abuse_reports_file_target_idx` ON `abuse_reports` ('/f/' || ltrim(substr("target", 4), '/'),`status`) WHERE "target" glob '/f/*';
