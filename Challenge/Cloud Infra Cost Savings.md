# Architecture Transition (x86 -> Arm)
- **challenge** <br>
  - 어느 정도 수준에서 최적화된 Cloud Infra 비용은 성능을 유지하며 비용은 줄이기 어려움 <br>
  - 기존 x86 기반 architecture를 Arm 기반 architecture로 전환 <br>
  - 기존에 사용 중인 k8s 관련 서비스 및 애플리케이션의 멀티 빌드가 가능해야 함 <br>
- **solution** <br>
  - docker buildx 를 통한 multi architecture build 및 k8s plugin의 arm architecture 호환 체크
- **pros** <br>
  - x86 architecture 기반 컴퓨팅 서비스 대비 고성능 저비용
- **cons** <br>
  - arm 환경에서 기동한 어플리케이션의 불안정성 이슈 존재
  - arm 환경에서 library 및 package를 동일하게 지원하는지 확인 필요

# VPC internal network
- **challenge** <br>
  - 클라우드 내 여러 리소스를 사용하는 과정에서 NAT Gateway를 통하는 경우, Region 간 통신, AZ 간 통신 등에서 Data Transfer/Processing 비용이 예상치 못하게 발생 가능 <br>
- **solution** <br>
  - 가능한 동일 AZ 내에 관련 리소스 배치하여 AZ 간 데이터 전송 비용 최소화
  - VPC Endpoint 또는 PrivateLink 사용하여 AWS 서비스 간 통신을 내부 네트워크로 유지
  - 대용량 데이터 전송 시 S3 Transfer Acceleration 또는 Direct Connect 활용
  - 네트워크 트래픽 모니터링 및 비용 분석 도구 도입
- **pros** <br>
  - 데이터 전송 비용 감소
  - 네트워크 지연 시간 감소로 애플리케이션 성능 향상
  - 인터넷 경유 없는 통신으로 보안성 강화
- **cons** <br>
  - 리소스 배치 제약으로 인한 설계 복잡성 증가
  - 일부 서비스에서는 VPC Endpoint 지원 제한적
  - 멀티 리전 아키텍처 구성 시 비용 최적화와 고가용성 간 균형 필요
