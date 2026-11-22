# Backups, all within the Always Free allowance:
#  1. The app writes a consistent copy of its SQLite database (photos included) once a day
#     into a private bucket, through a write-only pre-authenticated URL: the VM holds no key
#     that can read, list or delete backups. Copies expire after 14 days (lifecycle rule);
#     versioning keeps an overwritten copy for a day.
#  2. The block volume behind /data gets a weekly incremental backup, two kept.
# Free tier: 20 GB of Object Storage, so 14 copies need the database under ~1.4 GB; and five
# volume backups in total.

data "oci_objectstorage_namespace" "this" {
  compartment_id = var.tenancy_ocid
}

locals {
  backup_retention_days = 14
  # The upload URL stops working after this; renew it (and BACKUP_URL) before then.
  backup_url_expires = "2028-11-30T00:00:00Z"
}

resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.tenancy_ocid
  namespace      = data.oci_objectstorage_namespace.this.namespace
  name           = "${local.name_prefix}-backups"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Enabled"
  freeform_tags  = local.common_tags
}

# Lifecycle rules run as the Object Storage service, which needs leave to delete here.
resource "oci_identity_policy" "backup_lifecycle" {
  compartment_id = var.tenancy_ocid
  name           = "${local.name_prefix}-backup-lifecycle"
  description    = "Lets Object Storage expire old backups in ${oci_objectstorage_bucket.backups.name}"
  statements = [
    "Allow service objectstorage-${var.region} to manage object-family in tenancy where target.bucket.name = '${oci_objectstorage_bucket.backups.name}'",
  ]
  freeform_tags = local.common_tags
}

resource "oci_objectstorage_object_lifecycle_policy" "backups" {
  namespace = data.oci_objectstorage_namespace.this.namespace
  bucket    = oci_objectstorage_bucket.backups.name

  rules {
    name        = "expire-backups"
    action      = "DELETE"
    target      = "objects"
    time_amount = local.backup_retention_days
    time_unit   = "DAYS"
    is_enabled  = true
  }
  rules {
    name        = "expire-overwritten"
    action      = "DELETE"
    target      = "previous-object-versions"
    time_amount = 1
    time_unit   = "DAYS"
    is_enabled  = true
  }

  depends_on = [oci_identity_policy.backup_lifecycle]
}

# Write-only: can add objects to this bucket, nothing else.
resource "oci_objectstorage_preauthrequest" "backup_upload" {
  namespace    = data.oci_objectstorage_namespace.this.namespace
  bucket       = oci_objectstorage_bucket.backups.name
  name         = "app-backup-upload"
  access_type  = "AnyObjectWrite"
  time_expires = local.backup_url_expires
}

resource "oci_core_volume_backup_policy" "weekly" {
  compartment_id = var.tenancy_ocid
  display_name   = "${local.name_prefix}-weekly"
  freeform_tags  = local.common_tags

  schedules {
    backup_type       = "INCREMENTAL"
    period            = "ONE_WEEK"
    day_of_week       = "SUNDAY"
    hour_of_day       = 19 # Monday 04:00 in Korea
    time_zone         = "UTC"
    retention_seconds = 14 * 24 * 60 * 60
  }
}

resource "oci_core_volume_backup_policy_assignment" "data" {
  asset_id  = oci_core_volume.data.id
  policy_id = oci_core_volume_backup_policy.weekly.id
}
