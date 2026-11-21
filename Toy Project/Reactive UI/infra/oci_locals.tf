locals {
  # Resources were created by the retired chat-service project and imported here.
  # Names/tags mirror the originals so the import is a no-op; rename separately
  # (display names and tags are in-place updates; dns/hostname labels force replacement).
  legacy_prefix = "chat-service-prod"

  legacy_tags = {
    Environment = "prod"
    ManagedBy   = "terraform"
    Project     = "chat-service"
  }
}
