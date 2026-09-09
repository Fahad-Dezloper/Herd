use anchor_lang::prelude::*;

#[error_code]
pub enum HerdError {
    #[msg("This room is not taking players")]
    RoomNotOpen,
    #[msg("This room is full")]
    RoomFull,
    #[msg("You are already in this room")]
    AlreadySeated,
    #[msg("A room needs at least three players")]
    TooFewPlayers,
    #[msg("The game is not running")]
    NotPlaying,
    #[msg("That session key is not in this room")]
    NotAPlayer,
    #[msg("You are out")]
    Eliminated,
    #[msg("You have already answered this round")]
    AlreadyAnswered,
    #[msg("An answer cannot be empty")]
    EmptyAnswer,
    #[msg("That answer is too long")]
    AnswerTooLong,
    #[msg("The round is still open")]
    RoundStillOpen,
    #[msg("The round is closed")]
    RoundClosed,
    #[msg("The rule for this round has already been requested")]
    RuleAlreadyRequested,
    #[msg("The rule for this round has not been drawn")]
    RuleNotDrawn,
    #[msg("The game is not over")]
    NotFinished,
    #[msg("This room has already paid out")]
    AlreadySettled,
    #[msg("The winners passed do not match the survivors")]
    WrongWinners,
    #[msg("Arithmetic overflow")]
    Overflow,
}
