# Network Security Configuration
resource "oci_core_security_list" "public_security_list" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.chat_vcn.id
  display_name   = "${local.name_prefix}-public-sl"

  # Allow all outbound traffic
  egress_security_rules {
    destination      = "0.0.0.0/0"
    protocol         = "all"
    destination_type = "CIDR_BLOCK"
    description      = "Allow all outbound traffic"
  }

  # Inbound traffic is controlled by Network Security Groups (NSGs)

  freeform_tags = merge(local.network_tags, {
    Type = "public"
  })
}

# Network Security Group (Alternative to Security Lists)
resource "oci_core_network_security_group" "chat_nsg" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.chat_vcn.id
  display_name   = "${local.name_prefix}-nsg"

  freeform_tags = local.network_tags
}

# NSG Rules for Chat Service
# SSH 접근 NSG 규칙
resource "oci_core_network_security_group_security_rule" "chat_nsg_rule_ingress_ssh" {
  network_security_group_id = oci_core_network_security_group.chat_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6"
  description               = "SSH access"

  source      = "0.0.0.0/0"
  source_type = "CIDR_BLOCK"

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# 애플리케이션 포트 접근 허용
resource "oci_core_network_security_group_security_rule" "chat_nsg_rule_ingress_app" {
  network_security_group_id = oci_core_network_security_group.chat_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6"
  description               = "Application port access"

  source      = "0.0.0.0/0"
  source_type = "CIDR_BLOCK"

  tcp_options {
    destination_port_range {
      min = 3000
      max = 3000
    }
  }
}

resource "oci_core_network_security_group_security_rule" "chat_nsg_rule_egress_all" {
  network_security_group_id = oci_core_network_security_group.chat_nsg.id
  direction                 = "EGRESS"
  protocol                  = "all"
  description               = "All outbound traffic"

  destination      = "0.0.0.0/0"
  destination_type = "CIDR_BLOCK"
}
