package repository

import (
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestPGXTextArrayScanner(t *testing.T) {
	var values []string
	scanner := pgtype.NewMap().SQLScanner(&values)
	err := scanner.Scan([]byte(`{"plain","comma,inside","quote\"inside","back\\slash"}`))
	if err != nil {
		t.Fatalf("scan PostgreSQL text array: %v", err)
	}

	want := []string{"plain", "comma,inside", `quote"inside`, `back\slash`}
	if !reflect.DeepEqual(values, want) {
		t.Fatalf("unexpected array values: got %#v, want %#v", values, want)
	}
}
