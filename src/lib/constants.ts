// Known CPSE names — used for the upload UI and for content-based detection
// of a "which CPSE" column in a mixed (multi-CPSE-in-one-file) dataset.
export const CPSE_LIST = ["ONGC", "IOCL", "SAIL", "BHEL", "CPCL", "BPCL", "NTPC", "HPCL", "GAIL", "OIL", "MRPL", "NMDC", "COAL INDIA", "NALCO"];

// Common material-master units of measure — used to content-detect a UOM
// column even when its header is unrecognized or missing.
export const COMMON_UOMS = ["NOS", "NO", "EA", "EACH", "KG", "MTR", "M", "LTR", "L", "SET", "PCS", "PC", "BOX", "ROLL", "PAIR", "LOT", "TON", "MT", "SQM", "KL", "DRUM", "BAG"];
