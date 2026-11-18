package services

import "errors"

type PayoutNotSubmittedError struct {
	Err error
}

func (e *PayoutNotSubmittedError) Error() string {
	return e.Err.Error()
}

func (e *PayoutNotSubmittedError) Unwrap() error {
	return e.Err
}

type PayoutRejectedError struct {
	Message string
}

func (e *PayoutRejectedError) Error() string {
	return e.Message
}

func PayoutFailureIsDefinitive(err error) bool {
	var notSubmitted *PayoutNotSubmittedError
	var rejected *PayoutRejectedError
	return errors.As(err, &notSubmitted) || errors.As(err, &rejected)
}
