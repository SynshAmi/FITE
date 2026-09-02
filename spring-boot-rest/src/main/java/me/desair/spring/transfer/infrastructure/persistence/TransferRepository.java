package me.desair.spring.transfer.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public interface TransferRepository extends JpaRepository<TransferEntity, String> {
    List<TransferEntity> findByExpiresAtBefore(Instant expiresAt);
}
