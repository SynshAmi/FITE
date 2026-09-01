package me.desair.spring.transfer;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import me.desair.spring.transfer.domain.TransferDomainException;

@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(TransferNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleTransferNotFound(TransferNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ErrorResponse("TRANSFER_NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(ChunkNotAvailableException.class)
    public ResponseEntity<ErrorResponse> handleChunkNotAvailable(ChunkNotAvailableException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ErrorResponse("CHUNK_NOT_AVAILABLE", ex.getMessage()));
    }

    @ExceptionHandler(StorageFileNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleStorageFileNotFound(StorageFileNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse("STORAGE_FAILURE", "A required file is missing from storage"));
    }

    @ExceptionHandler(me.desair.spring.transfer.domain.TransferExpiredException.class)
    public ResponseEntity<ErrorResponse> handleTransferExpired(me.desair.spring.transfer.domain.TransferExpiredException ex) {
        return ResponseEntity.status(HttpStatus.GONE)
                .body(new ErrorResponse("TRANSFER_EXPIRED", "This transfer has expired."));
    }

    @ExceptionHandler(TransferDomainException.class)
    public ResponseEntity<ErrorResponse> handleDomainException(TransferDomainException ex) {
        HttpStatus status = HttpStatus.BAD_REQUEST;
        if (ex.getMessage().contains("Invalid share token")) {
            status = HttpStatus.FORBIDDEN;
        }
        return ResponseEntity.status(status)
                .body(new ErrorResponse("DOMAIN_ERROR", ex.getMessage()));
    }
}
