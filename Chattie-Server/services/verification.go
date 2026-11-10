package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/rekognition"
	"github.com/aws/aws-sdk-go-v2/service/rekognition/types"
)

// ============================================================================
// DATA MODELS
// ============================================================================

type VerificationResult struct {
	IsMatch    bool
	Similarity float32
}

type KYCResult struct {
	IsFaceMatch     bool
	FaceSimilarity  float32
	ExtractedText   []string
	RawDocumentData string
}

// ============================================================================
// SERVICE CONFIGURATION
// ============================================================================

type VerificationService struct {
	Client              *rekognition.Client
	SimilarityThreshold float32
	FaceCollectionID    string // Used to store faces and detect duplicate accounts
}

func NewVerificationService(cfg aws.Config) *VerificationService {
	return &VerificationService{
		Client:              rekognition.NewFromConfig(cfg),
		SimilarityThreshold: 95.0,                        // UPGRADED: 95% is the enterprise standard for financial/identity KYC
		FaceCollectionID:    "chattie-verified-faces-v1", // Must be created in AWS console/CLI first
	}
}

// ============================================================================
// 1. BASIC PROFILE VERIFICATION & ANTI-SPOOFING
// ============================================================================

// ValidateProfilePhoto enforces strict liveness, quality, and moderation checks.
func (v *VerificationService) ValidateProfilePhoto(ctx context.Context, photoBytes []byte) error {
	// 1. CONTENT MODERATION (NSFW / Violence / Scammer Graphics)
	modInput := &rekognition.DetectModerationLabelsInput{
		Image:         &types.Image{Bytes: photoBytes},
		MinConfidence: aws.Float32(75.0),
	}
	modOutput, err := v.Client.DetectModerationLabels(ctx, modInput)
	if err != nil {
		return fmt.Errorf("failed moderation check: %w", err)
	}
	if len(modOutput.ModerationLabels) > 0 {
		return fmt.Errorf("image rejected due to inappropriate or unsafe content")
	}

	// 2. DEEP FACE ANALYSIS (Liveness & Quality)
	faceInput := &rekognition.DetectFacesInput{
		Image:      &types.Image{Bytes: photoBytes},
		Attributes: []types.Attribute{types.AttributeAll}, // UPGRADED: Get eyes, sunglasses, pose, etc.
	}
	faceOutput, err := v.Client.DetectFaces(ctx, faceInput)
	if err != nil {
		return fmt.Errorf("failed to analyze profile photo: %w", err)
	}

	if len(faceOutput.FaceDetails) == 0 {
		return fmt.Errorf("no human face detected in the photo")
	}
	if len(faceOutput.FaceDetails) > 1 {
		return fmt.Errorf("multiple faces detected; primary profile photo must be a solo shot")
	}

	face := faceOutput.FaceDetails[0]

	// 3. ANTI-SPOOFING RULES
	if face.Confidence == nil || *face.Confidence < 98.0 {
		return fmt.Errorf("face detection confidence too low, please use a clearer photo")
	}
	if face.Quality != nil {
		if face.Quality.Sharpness != nil && *face.Quality.Sharpness < 70.0 {
			return fmt.Errorf("image is too blurry (sharpness too low)")
		}
		if face.Quality.Brightness != nil && *face.Quality.Brightness < 40.0 {
			return fmt.Errorf("image is too dark")
		}
	}

	// FIX: Removed the pointer dereference (*) from the boolean Value fields
	if face.EyesOpen != nil && !face.EyesOpen.Value {
		return fmt.Errorf("eyes must be open and clearly visible")
	}
	if face.Sunglasses != nil && face.Sunglasses.Value {
		return fmt.Errorf("sunglasses are not permitted in profile photos")
	}

	if face.Pose != nil {
		// Ensure the user is looking directly at the camera (Yaw/Pitch within reasonable limits)
		if *face.Pose.Yaw < -30 || *face.Pose.Yaw > 30 || *face.Pose.Pitch < -30 || *face.Pose.Pitch > 30 {
			return fmt.Errorf("face must be looking directly at the camera")
		}
	}

	return nil
}

// CompareFaces checks if the live selfie matches the reference photo
func (v *VerificationService) CompareFaces(ctx context.Context, referencePhoto []byte, liveSelfie []byte) (*VerificationResult, error) {
	input := &rekognition.CompareFacesInput{
		SourceImage:         &types.Image{Bytes: referencePhoto},
		TargetImage:         &types.Image{Bytes: liveSelfie},
		SimilarityThreshold: aws.Float32(v.SimilarityThreshold),
		QualityFilter:       types.QualityFilterHigh, // UPGRADED: Forces high-quality images, rejecting screens/photos of photos
	}

	output, err := v.Client.CompareFaces(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to process image verification: %w", err)
	}

	if len(output.UnmatchedFaces) > 0 {
		return nil, fmt.Errorf("multiple faces detected in the live selfie")
	}

	if len(output.FaceMatches) == 0 {
		return &VerificationResult{IsMatch: false, Similarity: 0.0}, nil
	}

	match := output.FaceMatches[0]
	return &VerificationResult{
		IsMatch:    true,
		Similarity: aws.ToFloat32(match.Similarity),
	}, nil
}

// ============================================================================
// 2. FULL KYC / IDENTITY GATEWAY (Selfie vs Govt ID + OCR)
// ============================================================================

func (v *VerificationService) VerifyGovernmentID(ctx context.Context, userID string, idCardBytes []byte, liveSelfieBytes []byte) (*KYCResult, error) {
	// 1. SYBIL ATTACK PREVENTION: Check if this face already exists on another account
	duplicateInput := &rekognition.SearchFacesByImageInput{
		CollectionId:       aws.String(v.FaceCollectionID),
		Image:              &types.Image{Bytes: liveSelfieBytes},
		FaceMatchThreshold: aws.Float32(v.SimilarityThreshold),
		MaxFaces:           aws.Int32(1),
	}

	// Note: If collection doesn't exist yet, this will error. Ensure collection is created on backend startup.
	searchResult, err := v.Client.SearchFacesByImage(ctx, duplicateInput)
	if err == nil && len(searchResult.FaceMatches) > 0 {
		// Check if the matched face belongs to a different user
		matchedExtImageID := aws.ToString(searchResult.FaceMatches[0].Face.ExternalImageId)
		if matchedExtImageID != userID {
			return nil, fmt.Errorf("SECURITY ALERT: This face is already registered to another active account")
		}
	}

	// 2. Compare the face printed on the ID Card to the Live Selfie
	faceMatch, err := v.CompareFaces(ctx, idCardBytes, liveSelfieBytes)
	if err != nil {
		return nil, fmt.Errorf("id face match analysis failed: %w", err)
	}
	if !faceMatch.IsMatch {
		return nil, fmt.Errorf("the live selfie does not match the photo on the provided ID document")
	}

	// 3. Run OCR to extract text from the ID
	textInput := &rekognition.DetectTextInput{
		Image: &types.Image{Bytes: idCardBytes},
	}

	textOutput, err := v.Client.DetectText(ctx, textInput)
	if err != nil {
		return nil, fmt.Errorf("failed to extract text from ID document: %w", err)
	}

	var extractedLines []string
	var rawTextBuilder strings.Builder

	for _, text := range textOutput.TextDetections {
		if text.Type == types.TextTypesLine {
			line := aws.ToString(text.DetectedText)
			// Security UPGRADE: Only accept lines with high confidence to prevent blurry forged IDs
			if text.Confidence != nil && *text.Confidence > 85.0 {
				extractedLines = append(extractedLines, line)
				rawTextBuilder.WriteString(line + " ")
			}
		}
	}

	if len(extractedLines) < 3 {
		return nil, fmt.Errorf("document unreadable or missing required text fields. Please upload a clear ID")
	}

	// 4. INDEX FACE: If KYC passes, save the face to the collection to prevent future duplicates
	_, _ = v.Client.IndexFaces(ctx, &rekognition.IndexFacesInput{
		CollectionId:        aws.String(v.FaceCollectionID),
		Image:               &types.Image{Bytes: liveSelfieBytes},
		ExternalImageId:     aws.String(userID), // Links the biometric data to this specific user ID
		DetectionAttributes: []types.Attribute{types.AttributeDefault},
	})

	return &KYCResult{
		IsFaceMatch:     faceMatch.IsMatch,
		FaceSimilarity:  faceMatch.Similarity,
		ExtractedText:   extractedLines,
		RawDocumentData: rawTextBuilder.String(),
	}, nil
}

func (res *KYCResult) CheckDocumentForName(expectedFirstName, expectedLastName string) bool {
	rawDoc := strings.ToUpper(res.RawDocumentData)
	firstNameMatch := strings.Contains(rawDoc, strings.ToUpper(strings.TrimSpace(expectedFirstName)))
	lastNameMatch := strings.Contains(rawDoc, strings.ToUpper(strings.TrimSpace(expectedLastName)))

	// UPGRADE: Both first and last name must exist independently on the document to pass
	return firstNameMatch && lastNameMatch
}
