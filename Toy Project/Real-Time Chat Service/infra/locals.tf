# Local values and common configurations
locals {
  # Common naming convention
  name_prefix = "${var.project_name}-${var.environment}"

  # DNS label (remove hyphens for OCI DNS requirements)
  dns_label = "${replace(var.project_name, "-", "")}${var.environment}"

  # Common tags applied to all resources
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }

  # Resource-specific tags
  network_tags = merge(local.common_tags, {
    Type = "network"
  })

  compute_tags = merge(local.common_tags, {
    Type = "compute"
  })

  database_tags = merge(local.common_tags, {
    Type = "database"
  })

  storage_tags = merge(local.common_tags, {
    Type = "storage"
  })

  # Component-specific database tags
  messages_table_tags = merge(local.database_tags, {
    Component = "messages"
  })

  sessions_table_tags = merge(local.database_tags, {
    Component = "sessions"
  })

  rooms_table_tags = merge(local.database_tags, {
    Component = "rooms"
  })
}
