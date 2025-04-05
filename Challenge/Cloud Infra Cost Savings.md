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
- **pros** <br>
- **cons** <br>
