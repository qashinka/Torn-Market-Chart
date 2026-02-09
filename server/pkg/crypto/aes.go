package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
)

// Encrypt encrypts a plain text string using AES-GCM and returns a base64 encoded string.
// The key should be 32 bytes for AES-256.
func Encrypt(keyString string, stringToEncrypt string) (string, error) {
	key := []byte(keyString)
	plaintext := []byte(stringToEncrypt)

	if len(key) != 32 {
		return "", errors.New("key length must be 32 bytes")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := aesGCM.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts a base64 encoded string using AES-GCM.
func Decrypt(keyString string, encryptedString string) (string, error) {
	key := []byte(keyString)
	enc, err := base64.StdEncoding.DecodeString(encryptedString)
	if err != nil {
		return "", err
	}

	if len(key) != 32 {
		return "", errors.New("key length must be 32 bytes")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := aesGCM.NonceSize()
	if len(enc) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, ciphertext := enc[:nonceSize], enc[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}
