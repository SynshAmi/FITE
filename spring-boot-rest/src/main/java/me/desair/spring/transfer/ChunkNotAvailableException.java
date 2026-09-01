package me.desair.spring.transfer;

public class ChunkNotAvailableException extends RuntimeException {
    public ChunkNotAvailableException(String message) {
        super(message);
    }
}
