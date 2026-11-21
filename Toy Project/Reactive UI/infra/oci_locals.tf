locals {
  name_prefix = "reactive-ui"

  common_tags = {
    Environment = "prod"
    ManagedBy   = "terraform"
    Project     = "reactive-ui"
  }

  # Identifiers inherited from the retired chat-service project that cannot be
  # renamed in place (changing them would recreate resources):
  #   - VCN dns_label "chatserviceprod" -> replaces the VCN and everything in it
  #   - volume attachment display_name  -> detaches /data (mounted via fstab)
  # Both are internal-only and never exposed outside the VCN / OCI console.
  legacy_vcn_dns_label          = "chatserviceprod"
  legacy_volume_attachment_name = "chat-service-prod-data-attachment"
}
