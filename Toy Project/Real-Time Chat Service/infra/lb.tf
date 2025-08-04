# Public Flexible Load Balancer
resource "oci_load_balancer_load_balancer" "chat_lb" {
  compartment_id = var.compartment_ocid
  display_name   = "${local.name_prefix}-lb"

  shape = "flexible"
  shape_details {
    minimum_bandwidth_in_mbps = 10
    maximum_bandwidth_in_mbps = 10
  }

  subnet_ids                 = [oci_core_subnet.public_subnet.id]
  is_private                 = false
  network_security_group_ids = [oci_core_network_security_group.lb_nsg.id]

  freeform_tags = merge(local.network_tags, { Type = "lb" })
}

# Backend Set + Health-Checker
resource "oci_load_balancer_backend_set" "chat_bs" {
  load_balancer_id = oci_load_balancer_load_balancer.chat_lb.id
  name             = "chat-backend-set"
  policy           = "ROUND_ROBIN"

  health_checker {
    protocol          = "HTTP"
    url_path          = "/healthz"
    port              = 3000
    retries           = 3
    interval_ms       = 10000
    timeout_in_millis = 3000
  }
}

# Backend (VM 1대)
resource "oci_load_balancer_backend" "chat_backend" {
  load_balancer_id = oci_load_balancer_load_balancer.chat_lb.id
  backendset_name  = oci_load_balancer_backend_set.chat_bs.name

  ip_address = data.oci_core_private_ips.chat_server_private_ips.private_ips[0].ip_address
  port       = 3000
  weight     = 1
}

# Listeners
resource "oci_load_balancer_listener" "chat_http_listener" {
  load_balancer_id         = oci_load_balancer_load_balancer.chat_lb.id
  name                     = "http"
  default_backend_set_name = oci_load_balancer_backend_set.chat_bs.name
  protocol                 = "HTTP"
  port                     = 80
}

resource "oci_load_balancer_listener" "chat_https_listener" {
  load_balancer_id         = oci_load_balancer_load_balancer.chat_lb.id
  name                     = "https"
  default_backend_set_name = oci_load_balancer_backend_set.chat_bs.name
  protocol                 = "HTTP" # TLS 종료 시 TERMINATED_HTTPS 로 변경
  port                     = 443
  # ssl_configuration { certificate_name = "chat-cert" }
}

# Load Balancer 전용 NSG
resource "oci_core_network_security_group" "lb_nsg" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.chat_vcn.id
  display_name   = "${local.name_prefix}-lb-nsg"
  freeform_tags  = merge(local.network_tags, { Type = "lb" })
}

# Ingress: 인터넷 to LB (80)
resource "oci_core_network_security_group_security_rule" "lb_ingress_http" {
  network_security_group_id = oci_core_network_security_group.lb_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source_type               = "CIDR_BLOCK"
  source                    = "0.0.0.0/0"

  tcp_options {
    destination_port_range {
      min = 80
      max = 80
    }
  }
}

# Ingress: 인터넷 to LB (443)
resource "oci_core_network_security_group_security_rule" "lb_ingress_https" {
  network_security_group_id = oci_core_network_security_group.lb_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source_type               = "CIDR_BLOCK"
  source                    = "0.0.0.0/0"

  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

# Egress: LB to VM (3000)
resource "oci_core_network_security_group_security_rule" "lb_egress_to_vm" {
  network_security_group_id = oci_core_network_security_group.lb_nsg.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination_type          = "NETWORK_SECURITY_GROUP"
  destination               = oci_core_network_security_group.chat_nsg.id

  tcp_options {
    destination_port_range {
      min = 3000
      max = 3000
    }
  }
}

# VM-NSG에 LB 소스 허용 (3000)
resource "oci_core_network_security_group_security_rule" "vm_ingress_from_lb_3000" {
  network_security_group_id = oci_core_network_security_group.chat_nsg.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source_type               = "NETWORK_SECURITY_GROUP"
  source                    = oci_core_network_security_group.lb_nsg.id

  tcp_options {
    destination_port_range {
      min = 3000
      max = 3000
    }
  }
}
